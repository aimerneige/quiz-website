package server

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"math"
	"os"
	"strconv"
	"strings"
)

// dumpTables 是需要迁移的数据；登录会话不导出，迁移后用户重新登录即可。
var dumpTables = []struct{ name, columns, order string }{
	{"users", "id, username, password_hash, password_salt, created_at", "created_at, id"},
	{"questions", "user_id, id, question, hint, answer, tags, sort, updated_at", "user_id, sort, id"},
}

func sqlLiteral(v any) string {
	switch x := v.(type) {
	case nil:
		return "NULL"
	case int64:
		return strconv.FormatInt(x, 10)
	case float64:
		if math.Trunc(x) == x && math.Abs(x) < 1e15 {
			return strconv.FormatFloat(x, 'f', 1, 64)
		}
		return strconv.FormatFloat(x, 'g', -1, 64)
	case []byte:
		return "'" + strings.ReplaceAll(string(x), "'", "''") + "'"
	case string:
		return "'" + strings.ReplaceAll(x, "'", "''") + "'"
	default:
		return "'" + strings.ReplaceAll(fmt.Sprint(x), "'", "''") + "'"
	}
}

// ExportSQL 把用户和题目导出为 INSERT 语句，可在已建表的空数据库中执行，
// 例如 `wrangler d1 execute quiz --remote --file=quiz-data.sql`。
func ExportSQL(ctx context.Context, db *sql.DB, w io.Writer) error {
	fmt.Fprintln(w, "-- quiz 数据导出：在已执行迁移的空数据库中运行。")
	for _, t := range dumpTables {
		rows, err := db.QueryContext(ctx, fmt.Sprintf("SELECT %s FROM %s ORDER BY %s", t.columns, t.name, t.order))
		if err != nil {
			return err
		}
		n := len(strings.Split(t.columns, ","))
		for rows.Next() {
			values := make([]any, n)
			ptrs := make([]any, n)
			for i := range values {
				ptrs[i] = &values[i]
			}
			if err := rows.Scan(ptrs...); err != nil {
				rows.Close()
				return err
			}
			literals := make([]string, n)
			for i, v := range values {
				literals[i] = sqlLiteral(v)
			}
			if _, err := fmt.Fprintf(w, "INSERT INTO %s (%s) VALUES (%s);\n", t.name, t.columns, strings.Join(literals, ", ")); err != nil {
				rows.Close()
				return err
			}
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
	}
	return nil
}

// ImportSQL 创建新的数据库文件并执行 SQL 文件，然后补齐尚未执行的迁移。
// 支持 `wrangler d1 export` 导出的完整备份，以及 ExportSQL 导出的数据。
func ImportSQL(ctx context.Context, dbPath, sqlPath string, migrations fs.FS) error {
	if _, err := os.Stat(dbPath); err == nil {
		return fmt.Errorf("%s 已存在；为避免覆盖数据，请导入到新的数据库文件", dbPath)
	} else if !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	script, err := os.ReadFile(sqlPath)
	if err != nil {
		return err
	}
	db, err := sql.Open("sqlite", "file:"+dbPath+"?_pragma=foreign_keys(1)")
	if err != nil {
		return err
	}
	// wrangler d1 export 导出的完整备份自带表结构；只有数据的文件需要先建表。
	if !strings.Contains(string(script), "CREATE TABLE") {
		if err := migrate(ctx, db, migrations); err != nil {
			db.Close()
			os.Remove(dbPath)
			return err
		}
	}
	tx, err := db.BeginTx(ctx, nil)
	if err == nil {
		if _, err = tx.ExecContext(ctx, string(script)); err == nil {
			err = tx.Commit()
		} else {
			tx.Rollback()
		}
	}
	if err == nil {
		err = migrate(ctx, db, migrations)
	}
	db.Close()
	if err != nil {
		os.Remove(dbPath)
		return fmt.Errorf("import %s: %w", sqlPath, err)
	}
	return nil
}
