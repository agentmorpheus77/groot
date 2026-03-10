import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Database, Upload, Trash2, Eye, FileJson, Plus } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { listDatasets, uploadDataset, deleteDataset, previewDataset, type Dataset } from "@/api"
import { formatDate } from "@/lib/utils"
import { cn } from "@/lib/utils"

export default function Datasets() {
  const { t } = useTranslation()
  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [previewData, setPreviewData] = useState<{ dataset: Dataset; rows: any[] } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Dataset | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = () => listDatasets().then(r => setDatasets(r.data)).catch(console.error)
  useEffect(() => { load() }, [])

  const handleFile = async (file: File) => {
    setUploading(true)
    setError(null)
    try {
      await uploadDataset(file)
      await load()
    } catch (e: any) {
      setError(e.response?.data?.detail || t("errors.uploadFailed"))
    } finally {
      setUploading(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  const handlePreview = async (ds: Dataset) => {
    try {
      const r = await previewDataset(ds.id)
      setPreviewData({ dataset: ds, rows: r.data.rows })
    } catch (e) {
      console.error(e)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await deleteDataset(deleteTarget.id)
      await load()
    } catch (e) {
      console.error(e)
    } finally {
      setDeleteTarget(null)
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20">
          <Database className="w-5 h-5 text-blue-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold">{t("datasets.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("datasets.subtitle")}</p>
        </div>
      </div>

      {/* Upload zone */}
      <Card className="glass-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Upload className="w-4 h-4 text-primary" />
            {t("datasets.upload.title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div
            className={cn(
              "border-2 border-dashed rounded-lg p-8 text-center transition-all cursor-pointer",
              dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30"
            )}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
          >
            <FileJson className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
            <p className="font-medium text-sm">
              {uploading ? t("datasets.upload.uploading") : t("datasets.upload.drag")}
            </p>
            <p className="text-xs text-muted-foreground mt-1">{t("datasets.upload.formats")}</p>
            <p className="text-xs text-muted-foreground/70 mt-2 font-mono">{t("datasets.upload.hint")}</p>
            <Button variant="outline" size="sm" className="mt-4" disabled={uploading}>
              <Plus className="w-3 h-3 mr-1" />
              {t("datasets.upload.button")}
            </Button>
          </div>
          {error && (
            <p className="mt-2 text-sm text-destructive flex items-center gap-1">
              ⚠️ {error}
            </p>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".jsonl,.json,.csv"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
          />
        </CardContent>
      </Card>

      {/* Dataset table */}
      <Card className="glass-card">
        <CardContent className="p-0">
          {datasets.length === 0 ? (
            <div className="py-12 text-center">
              <Database className="w-10 h-10 mx-auto mb-3 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">{t("datasets.empty")}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("datasets.table.name")}</TableHead>
                  <TableHead>{t("datasets.table.rows")}</TableHead>
                  <TableHead>{t("datasets.table.format")}</TableHead>
                  <TableHead>{t("datasets.table.created")}</TableHead>
                  <TableHead className="text-right">{t("datasets.table.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {datasets.map(ds => (
                  <TableRow key={ds.id}>
                    <TableCell className="font-medium">{ds.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{ds.row_count} {t("common.rows")}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="uppercase text-xs">{ds.format}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {formatDate(ds.created_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8"
                          onClick={() => handlePreview(ds)} title={t("common.preview")}>
                          <Eye className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(ds)} title={t("common.delete")}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Preview Dialog */}
      <Dialog open={!!previewData} onOpenChange={() => setPreviewData(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("datasets.preview.title")}: {previewData?.dataset.name}</DialogTitle>
            <DialogDescription>{t("datasets.preview.showing")}</DialogDescription>
          </DialogHeader>
          <ScrollArea className="h-96">
            <div className="space-y-3 pr-4">
              {previewData?.rows.map((row, i) => (
                <div key={i} className="p-3 rounded-lg bg-muted/40 border border-border/50">
                  <p className="text-xs font-mono text-foreground/80 whitespace-pre-wrap break-all">
                    {row.text || JSON.stringify(row, null, 2)}
                  </p>
                </div>
              ))}
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewData(null)}>{t("common.close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("datasets.delete.title")}</DialogTitle>
            <DialogDescription>{t("datasets.delete.confirm")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>{t("common.cancel")}</Button>
            <Button variant="destructive" onClick={handleDelete}>{t("common.delete")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
