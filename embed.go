// Package quiz 嵌入前端静态文件和数据库迁移，供自部署的 Go 后端使用。
package quiz

import (
	"embed"
	"io/fs"
)

//go:embed all:src
var static embed.FS

//go:embed migrations/*.sql
var migrations embed.FS

// Static 返回前端文件（src/ 目录的内容）。
func Static() fs.FS {
	sub, err := fs.Sub(static, "src")
	if err != nil {
		panic(err)
	}
	return sub
}

// Migrations 返回 migrations/ 中的 SQL 文件；Cloudflare D1 与 Go 后端共用。
func Migrations() fs.FS {
	sub, err := fs.Sub(migrations, "migrations")
	if err != nil {
		panic(err)
	}
	return sub
}
