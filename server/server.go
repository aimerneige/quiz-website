// Package server 是 quiz 的自部署后端：提供与 Cloudflare Worker 相同的 /api 接口，
// 使用 SQLite 存储数据，并直接提供前端静态文件。
package server

import (
	"database/sql"
	"encoding/json"
	"errors"
	"io/fs"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
)

// 单次请求体上限。10,000 道题、每题含长答案时仍可一次导入。
const maxBodyBytes = 100 << 20

type Options struct {
	// Static 是前端文件；为 nil 时只提供 /api。
	Static fs.FS
	// TrustProxy 为 true 时信任反向代理传入的 X-Forwarded-Proto / X-Forwarded-Host。
	TrustProxy bool
	Logger     *slog.Logger
}

type Server struct {
	db     *sql.DB
	opts   Options
	static http.Handler
	log    *slog.Logger
}

func New(db *sql.DB, opts Options) *Server {
	s := &Server{db: db, opts: opts, log: opts.Logger}
	if s.log == nil {
		s.log = slog.Default()
	}
	if opts.Static != nil {
		s.static = http.FileServerFS(opts.Static)
	}
	return s
}

type apiError struct {
	status int
	code   string
	detail map[string]any
}

func (e *apiError) Error() string { return e.code }

func httpError(status int, code string) error { return &apiError{status: status, code: code} }

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func readJSON(r *http.Request, dst any) error {
	if !strings.Contains(r.Header.Get("Content-Type"), "application/json") {
		return httpError(http.StatusUnsupportedMediaType, "json_required")
	}
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			return httpError(http.StatusRequestEntityTooLarge, "too_large")
		}
		return httpError(http.StatusBadRequest, "invalid_json")
	}
	return nil
}

func (s *Server) isHTTPS(r *http.Request) bool {
	if r.TLS != nil {
		return true
	}
	return s.opts.TrustProxy && strings.EqualFold(strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-Proto"), ",")[0]), "https")
}

func (s *Server) host(r *http.Request) string {
	if s.opts.TrustProxy {
		if forwarded := strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-Host"), ",")[0]); forwarded != "" {
			return forwarded
		}
	}
	return r.Host
}

// sameOrigin 拒绝跨站提交；配合 SameSite Cookie 和 JSON 请求体防御 CSRF。
func (s *Server) sameOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	return strings.EqualFold(u.Host, s.host(r))
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if !strings.HasPrefix(r.URL.Path, "/api/") {
		if s.static == nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-cache")
		s.static.ServeHTTP(w, r)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	if err := s.route(w, r); err != nil {
		var e *apiError
		if errors.As(err, &e) {
			body := map[string]any{"error": e.code}
			if e.detail != nil {
				body["detail"] = e.detail
			}
			writeJSON(w, e.status, body)
			return
		}
		s.log.Error("request failed", "method", r.Method, "path", r.URL.Path, "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "server_error"})
	}
}

func (s *Server) route(w http.ResponseWriter, r *http.Request) error {
	if r.Method != http.MethodGet && r.Method != http.MethodHead && !s.sameOrigin(r) {
		return httpError(http.StatusForbidden, "forbidden_origin")
	}
	switch r.Method + " " + r.URL.Path {
	case "GET /api/auth/me":
		return s.handleMe(w, r)
	case "POST /api/auth/register":
		return s.handleRegister(w, r)
	case "POST /api/auth/login":
		return s.handleLogin(w, r)
	case "POST /api/auth/logout":
		return s.handleLogout(w, r)
	case "GET /api/questions":
		return s.handleListQuestions(w, r)
	case "POST /api/questions/sync":
		return s.handleSync(w, r)
	}
	return httpError(http.StatusNotFound, "not_found")
}
