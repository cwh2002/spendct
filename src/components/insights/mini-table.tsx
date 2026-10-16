/**
 * 简易两列表格：图表数据表的通用载体（05 §3.6 规则 6 的无障碍救济）。
 * 账本汇总与商户统计的 ChartCard 均以本表作为图表的数据表视图，
 * 保证「图表 / 数据表切换」在两种视图下的行高与样式一致。
 */

interface MiniTableProps {
  /** 表头两列（左对齐标签列 + 右对齐数值列） */
  headers: [string, string];
  /** 数据行：[标签, 值] */
  rows: [string, string][];
}

export function MiniTable({ headers, rows }: MiniTableProps) {
  return (
    <div className="h-[260px] overflow-y-auto rounded-(--radius-md) border border-(--color-border)">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-(--color-surface)">
          <tr className="border-b border-(--color-border) text-left text-xs text-(--color-ink-muted)">
            <th scope="col" className="px-3 py-2 font-medium">
              {headers[0]}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              {headers[1]}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label} className="border-b border-(--color-border) last:border-0">
              <td className="px-3 py-1.5 text-(--color-ink-secondary)">{label}</td>
              <td className="px-3 py-1.5 text-right font-medium tabular-nums">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
