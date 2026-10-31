// quiz-server 是 quiz 的自部署后端：一个可执行文件即可提供网页、注册登录和云端题库。
//
//	quiz-server -addr :8080 -db ./data/quiz.db     启动服务
//	quiz-server export -db ./data/quiz.db > a.sql   导出用户和题目
//	quiz-server import -db ./new.db backup.sql      从 SQL 文件创建新数据库
//
// 服务参数也可以用环境变量设置：QUIZ_ADDR、QUIZ_DB、QUIZ_STATIC、QUIZ_TRUST_PROXY。
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"
	"time"

	quiz "github.com/aimerneige/quiz-website"
	"github.com/aimerneige/quiz-website/server"
)

func env(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return fallback
}

func main() {
	if len(os.Args) > 1 && (os.Args[1] == "import" || os.Args[1] == "export") {
		if err := dataCommand(os.Args[1], os.Args[2:]); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}
	if len(os.Args) > 1 && os.Args[1] == "serve" {
		os.Args = append(os.Args[:1], os.Args[2:]...)
	}
	trustDefault, _ := strconv.ParseBool(env("QUIZ_TRUST_PROXY", "false"))
	addr := flag.String("addr", env("QUIZ_ADDR", ":8080"), "监听地址 (QUIZ_ADDR)")
	dbPath := flag.String("db", env("QUIZ_DB", "quiz.db"), "SQLite 数据库文件路径，不存在时自动创建 (QUIZ_DB)")
	staticDir := flag.String("static", env("QUIZ_STATIC", ""), "前端文件目录；留空使用内置的前端 (QUIZ_STATIC)")
	apiOnly := flag.Bool("api-only", false, "只提供 /api，不提供前端文件")
	trustProxy := flag.Bool("trust-proxy", trustDefault, "位于反向代理之后时开启，信任 X-Forwarded-* 请求头 (QUIZ_TRUST_PROXY)")
	flag.Parse()

	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	if err := run(logger, *addr, *dbPath, *staticDir, *apiOnly, *trustProxy); err != nil {
		logger.Error("quiz-server stopped", "err", err)
		os.Exit(1)
	}
}

func run(logger *slog.Logger, addr, dbPath, staticDir string, apiOnly, trustProxy bool) error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if dir := filepath.Dir(dbPath); dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
	}
	db, err := server.OpenDB(ctx, dbPath, quiz.Migrations())
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	defer db.Close()

	var static fs.FS
	switch {
	case apiOnly:
	case staticDir != "":
		static = os.DirFS(staticDir)
	default:
		static = quiz.Static()
	}
	app := server.New(db, server.Options{Static: static, TrustProxy: trustProxy, Logger: logger})

	go func() {
		ticker := time.NewTicker(time.Hour)
		defer ticker.Stop()
		for {
			if err := app.CleanupSessions(ctx); err != nil && ctx.Err() == nil {
				logger.Warn("cleanup sessions", "err", err)
			}
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()

	srv := &http.Server{
		Addr:              addr,
		Handler:           app,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       2 * time.Minute,
		WriteTimeout:      2 * time.Minute,
		IdleTimeout:       2 * time.Minute,
	}
	errc := make(chan error, 1)
	go func() { errc <- srv.ListenAndServe() }()
	logger.Info("quiz-server listening", "addr", addr, "db", dbPath, "trustProxy", trustProxy)

	select {
	case err := <-errc:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-ctx.Done():
		logger.Info("shutting down")
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return srv.Shutdown(shutdown)
	}
	return nil
}

func dataCommand(name string, args []string) error {
	flags := flag.NewFlagSet(name, flag.ExitOnError)
	dbPath := flags.String("db", env("QUIZ_DB", "quiz.db"), "SQLite 数据库文件路径 (QUIZ_DB)")
	flags.Usage = func() {
		if name == "import" {
			fmt.Fprintln(flags.Output(), "用法：quiz-server import -db 新数据库.db 备份.sql")
		} else {
			fmt.Fprintln(flags.Output(), "用法：quiz-server export -db quiz.db > quiz-data.sql")
		}
		flags.PrintDefaults()
	}
	flags.Parse(args)
	ctx := context.Background()
	if name == "import" {
		if flags.NArg() != 1 {
			flags.Usage()
			os.Exit(2)
		}
		if err := server.ImportSQL(ctx, *dbPath, flags.Arg(0), quiz.Migrations()); err != nil {
			return err
		}
		fmt.Fprintf(os.Stderr, "已导入到 %s\n", *dbPath)
		return nil
	}
	if _, err := os.Stat(*dbPath); err != nil {
		return fmt.Errorf("找不到数据库 %s: %w", *dbPath, err)
	}
	db, err := server.OpenDB(ctx, *dbPath, quiz.Migrations())
	if err != nil {
		return err
	}
	defer db.Close()
	return server.ExportSQL(ctx, db, os.Stdout)
}
