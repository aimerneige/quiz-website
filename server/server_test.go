package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	quiz "github.com/aimerneige/quiz-website"
)

func TestPasswordHashMatchesWorker(t *testing.T) {
	// 由 cloudflare/worker.js 的 hashPassword 生成，保证两种后端的账户可以互相迁移。
	hash, salt, err := hashPassword("correct horse", "00112233445566778899aabbccddeeff")
	if err != nil {
		t.Fatal(err)
	}
	if hash != "349385d8369097aac69c91b9cf79c08cc236bd0eea62faca19643b117ca1f56e" || salt != "00112233445566778899aabbccddeeff" {
		t.Fatalf("hash mismatch: %s", hash)
	}
}

func TestParseTagsMatchesFrontend(t *testing.T) {
	cases := map[string][]string{
		`["a"," b ","a",""]`: {"a", "b"},
		`"科学，常识;英语|科学\n"`:    {"科学", "常识", "英语"},
		`"[\"x\",\"y\"]"`:    {"x", "y"},
		`null`:               {},
		`[1,"1"]`:            {"1"},
	}
	for in, want := range cases {
		got, ok := parseTags(json.RawMessage(in))
		if !ok || !reflect.DeepEqual(got, want) {
			t.Errorf("parseTags(%s) = %v, %v; want %v", in, got, ok, want)
		}
	}
}

func TestLengthsUseUTF16Units(t *testing.T) {
	if jsLength("😀a") != 3 {
		t.Fatal("emoji should count as two UTF-16 units")
	}
	tag := strings.Repeat("😀", 21) // 42 个 UTF-16 码元，超过 40
	_, problem := normalizeQuestion(incomingQuestion{ID: json.RawMessage(`"x"`), Question: json.RawMessage(`"q"`), Sort: json.RawMessage(`1`), Tags: json.RawMessage(`["` + tag + `"]`)})
	if problem == "" {
		t.Fatal("expected tag length error")
	}
}

func TestMigrationsAreIdempotentAndUseD1Table(t *testing.T) {
	path := filepath.Join(t.TempDir(), "quiz.db")
	for i := 0; i < 2; i++ {
		db, err := OpenDB(context.Background(), path, quiz.Migrations())
		if err != nil {
			t.Fatal(err)
		}
		var names []string
		rows, _ := db.Query("SELECT name FROM d1_migrations ORDER BY id")
		for rows.Next() {
			var n string
			rows.Scan(&n)
			names = append(names, n)
		}
		rows.Close()
		db.Close()
		if !reflect.DeepEqual(names, []string{"0001_init.sql"}) {
			t.Fatalf("run %d: migrations = %v", i, names)
		}
	}
}

func TestOriginCheckBehindProxy(t *testing.T) {
	db, err := OpenDB(context.Background(), filepath.Join(t.TempDir(), "quiz.db"), quiz.Migrations())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	post := func(s *Server, headers map[string]string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:8080/api/auth/register", strings.NewReader(`{"username":"proxy_user","password":"password1"}`))
		r.Header.Set("Content-Type", "application/json")
		for k, v := range headers {
			r.Header.Set(k, v)
		}
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		return w
	}
	headers := map[string]string{"Origin": "https://quiz.example.com", "X-Forwarded-Host": "quiz.example.com", "X-Forwarded-Proto": "https"}
	if w := post(New(db, Options{}), headers); w.Code != http.StatusForbidden {
		t.Fatalf("untrusted proxy headers should be ignored, got %d", w.Code)
	}
	w := post(New(db, Options{TrustProxy: true}), headers)
	if w.Code != http.StatusCreated {
		t.Fatalf("trusted proxy: got %d %s", w.Code, w.Body)
	}
	if cookie := w.Header().Get("Set-Cookie"); !strings.Contains(cookie, "Secure") || !strings.Contains(cookie, "HttpOnly") {
		t.Fatalf("cookie should be Secure behind an HTTPS proxy: %s", cookie)
	}
}
