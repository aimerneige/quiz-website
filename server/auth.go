package server

import (
	"context"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf16"
)

// 与 Cloudflare Worker 使用完全相同的算法和参数，两种后端的数据库可以互相迁移。
const (
	sessionCookie    = "quiz_session"
	sessionLifetime  = 30 * 24 * time.Hour
	pbkdf2Iterations = 100000
)

var (
	usernamePattern = regexp.MustCompile(`^[A-Za-z0-9_.-]{3,32}$`)
	tokenPattern    = regexp.MustCompile(`^[0-9a-f]{64}$`)
)

type user struct {
	ID       string
	Username string
}

func randomHex(n int) string {
	b := make([]byte, n)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func sha256Hex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

// jsLength 按 UTF-16 码元计算长度，与前端和 Worker 中 JavaScript 的 String.length 一致。
func jsLength(s string) int {
	return len(utf16.Encode([]rune(s)))
}

func hashPassword(password, saltHex string) (hash, salt string, err error) {
	if saltHex == "" {
		saltHex = randomHex(16)
	}
	saltBytes, err := hex.DecodeString(saltHex)
	if err != nil {
		return "", "", err
	}
	key, err := pbkdf2.Key(sha256.New, password, saltBytes, pbkdf2Iterations, 32)
	if err != nil {
		return "", "", err
	}
	return hex.EncodeToString(key), saltHex, nil
}

type credentials struct {
	Username any `json:"username"`
	Password any `json:"password"`
}

func (c credentials) values() (string, string) {
	username, _ := c.Username.(string)
	password, _ := c.Password.(string)
	return strings.TrimSpace(username), password
}

func (s *Server) currentUser(r *http.Request) (*user, error) {
	cookie, err := r.Cookie(sessionCookie)
	if err != nil || !tokenPattern.MatchString(cookie.Value) {
		return nil, nil
	}
	var u user
	err = s.db.QueryRowContext(r.Context(),
		`SELECT users.id, users.username FROM sessions JOIN users ON users.id = sessions.user_id
		 WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
		sha256Hex(cookie.Value), time.Now().UnixMilli()).Scan(&u.ID, &u.Username)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (s *Server) requireUser(r *http.Request) (*user, error) {
	u, err := s.currentUser(r)
	if err != nil {
		return nil, err
	}
	if u == nil {
		return nil, httpError(http.StatusUnauthorized, "unauthorized")
	}
	return u, nil
}

func (s *Server) setSessionCookie(w http.ResponseWriter, r *http.Request, token string, maxAge int) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    token,
		Path:     "/",
		MaxAge:   maxAge,
		HttpOnly: true,
		Secure:   s.isHTTPS(r),
		SameSite: http.SameSiteLaxMode,
	})
}

func (s *Server) startSession(w http.ResponseWriter, r *http.Request, u user, status int) error {
	token := randomHex(32)
	now := time.Now()
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(r.Context(), "DELETE FROM sessions WHERE user_id = ? AND expires_at <= ?", u.ID, now.UnixMilli()); err != nil {
		return err
	}
	if _, err := tx.ExecContext(r.Context(), "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
		sha256Hex(token), u.ID, now.Add(sessionLifetime).UnixMilli()); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	s.setSessionCookie(w, r, token, int(sessionLifetime.Seconds()))
	writeJSON(w, status, map[string]any{"user": map[string]string{"username": u.Username}})
	return nil
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) error {
	u, err := s.currentUser(r)
	if err != nil {
		return err
	}
	if u == nil {
		writeJSON(w, http.StatusOK, map[string]any{"user": nil})
		return nil
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": map[string]string{"username": u.Username}})
	return nil
}

func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) error {
	var body credentials
	if err := readJSON(r, &body); err != nil {
		return err
	}
	username, password := body.values()
	if !usernamePattern.MatchString(username) {
		return httpError(http.StatusBadRequest, "invalid_username")
	}
	if n := jsLength(password); n < 8 || n > 128 {
		return httpError(http.StatusBadRequest, "invalid_password")
	}
	hash, salt, err := hashPassword(password, "")
	if err != nil {
		return err
	}
	u := user{ID: newUUID(), Username: username}
	_, err = s.db.ExecContext(r.Context(),
		"INSERT INTO users (id, username, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?)",
		u.ID, username, hash, salt, time.Now().UnixMilli())
	if isUniqueViolation(err) {
		return httpError(http.StatusConflict, "username_taken")
	}
	if err != nil {
		return err
	}
	return s.startSession(w, r, u, http.StatusCreated)
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) error {
	var body credentials
	if err := readJSON(r, &body); err != nil {
		return err
	}
	username, password := body.values()
	var u user
	var storedHash, salt string
	found := false
	if username != "" && jsLength(password) <= 128 {
		err := s.db.QueryRowContext(r.Context(),
			"SELECT id, username, password_hash, password_salt FROM users WHERE username = ?", username).
			Scan(&u.ID, &u.Username, &storedHash, &salt)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		found = err == nil
	}
	// 用户不存在时也计算一次哈希，避免通过响应时间判断用户名是否存在。
	hash, _, err := hashPassword(password, salt)
	if err != nil {
		return err
	}
	if !found || subtle.ConstantTimeCompare([]byte(hash), []byte(storedHash)) != 1 {
		return httpError(http.StatusUnauthorized, "invalid_credentials")
	}
	return s.startSession(w, r, u, http.StatusOK)
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) error {
	if cookie, err := r.Cookie(sessionCookie); err == nil && cookie.Value != "" {
		if _, err := s.db.ExecContext(r.Context(), "DELETE FROM sessions WHERE token_hash = ?", sha256Hex(cookie.Value)); err != nil {
			return err
		}
	}
	s.setSessionCookie(w, r, "", -1)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	return nil
}

// CleanupSessions 删除所有已过期的登录会话，由主程序定期调用。
func (s *Server) CleanupSessions(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, "DELETE FROM sessions WHERE expires_at <= ?", time.Now().UnixMilli())
	return err
}

func newUUID() string {
	b := make([]byte, 16)
	rand.Read(b)
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	h := hex.EncodeToString(b)
	return h[0:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:]
}
