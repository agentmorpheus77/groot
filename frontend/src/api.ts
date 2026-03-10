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
export const chatWithModel = (id: number, prompt: string, max_tokens = 256) =>
  api.post<{ model_id: number; model_name: string; prompt: string; response: string }>(
    `/models/${id}/chat`,
    { prompt, max_tokens }
  )
export const getStats = () => api.get<Stats>("/models/stats/summary")

export default api
