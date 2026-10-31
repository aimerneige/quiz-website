package server

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"regexp"
	"strings"
	"time"
)

const (
	maxQuestions = 10000
	maxChanges   = 20000
)

// Question 是 API 中题目的格式，与 Worker 和前端一致。
type Question struct {
	ID       string   `json:"id"`
	Question string   `json:"question"`
	Hint     string   `json:"hint"`
	Answer   string   `json:"answer"`
	Tags     []string `json:"tags"`
	Sort     float64  `json:"sort"`
}

var tagSeparator = regexp.MustCompile(`[,，;；|\n]`)

// text 与前端 String(value) 的常见情况一致：字符串原样返回，数字转为文本，缺失或 null 为空字符串。
func text(raw json.RawMessage) (string, bool) {
	if len(raw) == 0 || string(raw) == "null" {
		return "", true
	}
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s, true
	}
	var n json.Number
	if json.Unmarshal(raw, &n) == nil {
		return n.String(), true
	}
	if string(raw) == "true" || string(raw) == "false" {
		return string(raw), true
	}
	return "", false
}

// parseTags 对应 src/core.js 中的 parseTags：支持数组、JSON 数组字符串和分隔符字符串，去除空白与重复。
func parseTags(raw json.RawMessage) ([]string, bool) {
	var items []string
	var list []json.RawMessage
	if json.Unmarshal(raw, &list) == nil {
		for _, item := range list {
			s, ok := text(item)
			if !ok {
				return nil, false
			}
			items = append(items, s)
		}
	} else {
		s, ok := text(raw)
		if !ok {
			return nil, false
		}
		if strings.HasPrefix(strings.TrimSpace(s), "[") {
			var parsed []json.RawMessage
			if json.Unmarshal([]byte(s), &parsed) == nil {
				return parseTags(json.RawMessage(s))
			}
		}
		items = tagSeparator.Split(s, -1)
	}
	seen := map[string]bool{}
	tags := []string{}
	for _, tag := range items {
		tag = strings.TrimSpace(tag)
		if tag != "" && !seen[tag] {
			seen[tag] = true
			tags = append(tags, tag)
		}
	}
	return tags, true
}

type incomingQuestion struct {
	ID       json.RawMessage `json:"id"`
	Question json.RawMessage `json:"question"`
	Hint     json.RawMessage `json:"hint"`
	Answer   json.RawMessage `json:"answer"`
	Tags     json.RawMessage `json:"tags"`
	Sort     json.RawMessage `json:"sort"`
}

// normalizeQuestion 校验并整理一条题目，规则与 src/core.js 的 normalizeQuestion 相同。
func normalizeQuestion(in incomingQuestion) (Question, string) {
	var q Question
	if json.Unmarshal(in.ID, &q.ID) != nil || q.ID == "" || jsLength(q.ID) > 100 {
		return q, "题目 ID 无效"
	}
	var sortValue float64
	if json.Unmarshal(in.Sort, &sortValue) != nil || math.IsNaN(sortValue) || math.IsInf(sortValue, 0) {
		return q, "排序值无效"
	}
	q.Sort = sortValue
	var ok bool
	fields := []struct {
		raw json.RawMessage
		dst *string
	}{{in.Question, &q.Question}, {in.Hint, &q.Hint}, {in.Answer, &q.Answer}}
	for _, f := range fields {
		if *f.dst, ok = text(f.raw); !ok {
			return q, "题目必须是一个对象"
		}
		*f.dst = strings.TrimSpace(*f.dst)
	}
	if q.Tags, ok = parseTags(in.Tags); !ok {
		return q, "每题最多 20 个标签，每个标签最多 40 字"
	}
	if q.Question == "" {
		return q, "缺少题目"
	}
	if jsLength(q.Question) > 10000 || jsLength(q.Answer) > 30000 || jsLength(q.Hint) > 30000 {
		return q, "题目最多 10,000 字，提示和答案最多 30,000 字"
	}
	if len(q.Tags) > 20 {
		return q, "每题最多 20 个标签，每个标签最多 40 字"
	}
	for _, tag := range q.Tags {
		if jsLength(tag) > 40 {
			return q, "每题最多 20 个标签，每个标签最多 40 字"
		}
	}
	return q, ""
}

func (s *Server) handleListQuestions(w http.ResponseWriter, r *http.Request) error {
	u, err := s.requireUser(r)
	if err != nil {
		return err
	}
	rows, err := s.db.QueryContext(r.Context(),
		"SELECT id, question, hint, answer, tags, sort FROM questions WHERE user_id = ? ORDER BY sort, id", u.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	questions := []Question{}
	for rows.Next() {
		var q Question
		var tags string
		if err := rows.Scan(&q.ID, &q.Question, &q.Hint, &q.Answer, &tags, &q.Sort); err != nil {
			return err
		}
		if err := json.Unmarshal([]byte(tags), &q.Tags); err != nil || q.Tags == nil {
			q.Tags = []string{}
		}
		questions = append(questions, q)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, map[string]any{"questions": questions})
	return nil
}

type syncRequest struct {
	Upsert  []json.RawMessage `json:"upsert"`
	Remove  []json.RawMessage `json:"remove"`
	Replace bool              `json:"replace"`
}

// handleSync 增量同步：upsert 新增或修改的题目，remove 删除的题目；replace 先清空整个题库。全部在一个事务中完成。
func (s *Server) handleSync(w http.ResponseWriter, r *http.Request) error {
	u, err := s.requireUser(r)
	if err != nil {
		return err
	}
	var body syncRequest
	if err := readJSON(r, &body); err != nil {
		return err
	}
	if len(body.Upsert)+len(body.Remove) > maxChanges {
		return httpError(http.StatusRequestEntityTooLarge, "too_many_changes")
	}
	var remove []string
	for _, raw := range body.Remove {
		var id string
		if json.Unmarshal(raw, &id) == nil {
			remove = append(remove, id)
		}
	}
	items := make([]Question, 0, len(body.Upsert))
	index := map[string]int{}
	for i, raw := range body.Upsert {
		var in incomingQuestion
		if err := json.Unmarshal(raw, &in); err != nil {
			return &apiError{status: http.StatusBadRequest, code: "invalid_question", detail: map[string]any{"index": i}}
		}
		q, problem := normalizeQuestion(in)
		if problem != "" {
			return &apiError{status: http.StatusBadRequest, code: "invalid_question", detail: map[string]any{"index": i, "message": problem}}
		}
		if at, ok := index[q.ID]; ok {
			items[at] = q
		} else {
			index[q.ID] = len(items)
			items = append(items, q)
		}
	}

	ctx := r.Context()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if body.Replace {
		if _, err := tx.ExecContext(ctx, "DELETE FROM questions WHERE user_id = ?", u.ID); err != nil {
			return err
		}
	} else if len(remove) > 0 {
		stmt, err := tx.PrepareContext(ctx, "DELETE FROM questions WHERE user_id = ? AND id = ?")
		if err != nil {
			return err
		}
		defer stmt.Close()
		for _, id := range remove {
			if _, err := stmt.ExecContext(ctx, u.ID, id); err != nil {
				return err
			}
		}
	}
	if len(items) > 0 {
		stmt, err := tx.PrepareContext(ctx, `INSERT INTO questions (user_id, id, question, hint, answer, tags, sort, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT (user_id, id) DO UPDATE SET question = excluded.question, hint = excluded.hint, answer = excluded.answer,
				tags = excluded.tags, sort = excluded.sort, updated_at = excluded.updated_at`)
		if err != nil {
			return err
		}
		defer stmt.Close()
		now := time.Now().UnixMilli()
		for _, q := range items {
			tags, _ := json.Marshal(q.Tags)
			if _, err := stmt.ExecContext(ctx, u.ID, q.ID, q.Question, q.Hint, q.Answer, string(tags), q.Sort, now); err != nil {
				return fmt.Errorf("upsert question: %w", err)
			}
		}
	}
	// 在同一事务中检查数量，超出上限时回滚全部修改。
	var total int
	if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM questions WHERE user_id = ?", u.ID).Scan(&total); err != nil {
		return err
	}
	if total > maxQuestions {
		return httpError(http.StatusRequestEntityTooLarge, "too_many_questions")
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "total": total})
	return nil
}
