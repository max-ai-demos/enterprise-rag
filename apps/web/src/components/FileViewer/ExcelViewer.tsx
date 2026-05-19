'use client'
import { useEffect, useRef, useState } from 'react'
import * as XLSX from 'xlsx'

interface ExcelViewerProps {
  fileUrl: string
  sheetName?: string
  rowStart?: number
}

export function ExcelViewer({ fileUrl, sheetName, rowStart }: ExcelViewerProps) {
  const [sheets, setSheets] = useState<Record<string, string[][]>>({})
  const [activeSheet, setActiveSheet] = useState<string>('')
  const rowRefs = useRef<Record<number, HTMLTableRowElement | null>>({})

  useEffect(() => {
    fetch(fileUrl)
      .then(r => r.arrayBuffer())
      .then(buf => {
        const wb = XLSX.read(buf, { type: 'array' })
        const result: Record<string, string[][]> = {}
        wb.SheetNames.forEach(name => {
          const ws = wb.Sheets[name]
          result[name] = XLSX.utils.sheet_to_json(ws, { header: 1 }) as string[][]
        })
        setSheets(result)
        setActiveSheet(sheetName ?? wb.SheetNames[0])
      })
  }, [fileUrl, sheetName])

  useEffect(() => {
    if (rowStart !== undefined && rowRefs.current[rowStart]) {
      rowRefs.current[rowStart]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [sheets, rowStart])

  const rows = sheets[activeSheet] ?? []

  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-2 px-4 py-2 border-b bg-white">
        {Object.keys(sheets).map(name => (
          <button
            key={name}
            onClick={() => setActiveSheet(name)}
            className={`px-3 py-1 text-sm rounded ${activeSheet === name ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="overflow-auto flex-1 p-4">
        <table className="text-sm border-collapse w-full">
          <tbody>
            {rows.map((row, rIdx) => (
              <tr
                key={rIdx}
                ref={el => { rowRefs.current[rIdx + 1] = el }}
                className={rIdx + 1 === rowStart ? 'bg-yellow-100' : rIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
              >
                {(row as string[]).map((cell, cIdx) => (
                  <td key={cIdx} className="border px-2 py-1 whitespace-nowrap">
                    {String(cell ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
