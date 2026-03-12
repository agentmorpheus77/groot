import axios from "axios"

const api = axios.create({
  baseURL: "/api",
  timeout: 30000,
})

export interface Dataset {
  id: number
  name: string
  filename: string
  file_path: string
  row_count: number
  format: string
  created_at: string
}

export interface Job {
  id: number
  name: string
  dataset_id: number
  base_model: string
  status: "queued" | "running" | "completed" | "failed"
  epochs: number
  learning_rate: number
  max_seq_length: number
  batch_size: number
  iters: number
  adapter_path?: string
  fused_model_path?: string
  started_at?: string
  finished_at?: string
  created_at: string
  error_message?: string
  final_loss?: number
}

export interface Model {
  id: number
  name: string
  job_id?: number
  base_model: string
  adapter_path?: string
  fused_path?: string
  dataset_name: string
  training_time_seconds: number
  final_loss?: number
  created_at: string
  status: string
}

export interface Stats {
  datasets: number
  jobs: number
  models: number
  running_jobs: number
}

// Datasets
export const uploadDataset = (file: File) => {
  const form = new FormData()
  form.append("file", file)
  return api.post<Dataset>("/datasets", form)
}
export const listDatasets = () => api.get<Dataset[]>("/datasets")
export const deleteDataset = (id: number) => api.delete(`/datasets/${id}`)
export const previewDataset = (id: number) =>
  api.get<{ rows: { text: string }[]; total: number }>(`/datasets/${id}/preview`)

// Jobs
export const listJobs = () => api.get<Job[]>("/jobs")
export const createJob = (data: {
  name: string
  dataset_id: number
  base_model: string
  epochs?: number
  learning_rate?: number
  max_seq_length?: number
  batch_size?: number
  iters?: number
}) => api.post<Job>("/jobs", data)
export const deleteJob = (id: number) => api.delete(`/jobs/${id}`)
export const getBaseModels = () => api.get<{ models: string[] }>("/jobs/models")

// Models
export const listModels = () => api.get<Model[]>("/models")
export const deleteModel = (id: number) => api.delete(`/models/${id}`)
export const chatWithModel = (id: number, prompt: string, max_tokens = 256, system_prompt?: string) =>
  api.post<{ model_id: number; model_name: string; prompt: string; response: string }>(
    `/models/${id}/chat`,
    { prompt, max_tokens, ...(system_prompt ? { system_prompt } : {}) }
  )
export const getStats = () => api.get<Stats>("/models/stats/summary")

// ── Model Hub ────────────────────────────────────────────────────────────────

export interface HubModel {
  id: string
  name: string
  family: string
  size_label: string
  downloads: number
  likes: number
  tags: string[]
  languages: string[]
  description: string
  license: string
  is_cached: boolean
  created_at: string
}

export interface CachedModel {
  model_id: string
  cache_path: string
  size_bytes: number
  size_label: string
}

export const listHubModels = () =>
  api.get<{ models: HubModel[]; cached: boolean }>("/hub/models")

export const startDownload = (model_id: string) =>
  api.post<{ download_id: string; status: string }>("/hub/download", { model_id })

export const listCachedModels = () =>
  api.get<{ models: CachedModel[]; total_size_bytes: number; total_size_label: string }>("/hub/cached")

export const listAvailableForTraining = () =>
  api.get<{ models: { id: string; name: string; size: string }[] }>("/hub/available-for-training")

export const invalidateHubCache = () =>
  api.post("/hub/invalidate-cache")

export default api
