// Moved out of App.jsx unchanged (part of the file split).

import { FONT_MONO } from '../theme';

// Renders the declension/conjugation tables fetched by
// fetchInflectionTables — a plain HTML table per Wiktionary table,
// preserving its original colSpan/rowSpan so multi-column headers (e.g.
// "singular"/"plural" spanning several forms) still line up correctly.
export function InflectionTables({ tables }) {
  return (
    <div className="flex flex-col gap-4">
      {tables.map((table, i) => (
        <div key={i} className="overflow-x-auto">
          {table.caption && (
            <p style={{ color: '#8892AE', fontSize: '0.72rem', fontFamily: FONT_MONO, marginBottom: 4 }}>
              {table.caption}
            </p>
          )}
          <table style={{ borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <tbody>
              {table.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.cells.map((cell, ci) =>
                    cell.isHeader ? (
                      <th
                        key={ci}
                        colSpan={cell.colSpan}
                        rowSpan={cell.rowSpan}
                        style={{
                          border: '1px solid #2A3355',
                          padding: '4px 8px',
                          color: '#D4A54A',
                          fontWeight: 600,
                          textAlign: 'left',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {cell.text}
                      </th>
                    ) : (
                      <td
                        key={ci}
                        colSpan={cell.colSpan}
                        rowSpan={cell.rowSpan}
                        style={{
                          border: '1px solid #2A3355',
                          padding: '4px 8px',
                          color: '#F5F1E8',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {cell.text}
                      </td>
                    )
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
