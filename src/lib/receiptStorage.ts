import { supabase } from '../supabase'

const RECEIPTS_BUCKET = 'receipts'

function normalizeExt(file: File): string {
  const fromName = file.name.split('.').pop()?.toLowerCase()
  if (fromName && /^[a-z0-9]+$/.test(fromName)) return fromName
  if (file.type === 'image/png') return 'png'
  if (file.type === 'image/webp') return 'webp'
  if (file.type === 'image/heic') return 'heic'
  return 'jpg'
}

export function getReceiptPublicUrl(path?: string | null) {
  if (!supabase || !path) return null
  const { data } = supabase.storage.from(RECEIPTS_BUCKET).getPublicUrl(path)
  return data.publicUrl || null
}

export async function uploadReceiptAttachment(params: {
  file: File
  householdId: string
  userId: string
  previousPath?: string | null
}) {
  if (!supabase) throw new Error('Supabase לא מוגדר')

  const ext = normalizeExt(params.file)
  const cleanName = params.file.name.replace(/[^\p{L}\p{N}._-]/gu, '_')
  const path = `${params.householdId}/${params.userId}/${crypto.randomUUID()}-${cleanName || `receipt.${ext}`}`

  const { error: uploadError } = await supabase.storage.from(RECEIPTS_BUCKET).upload(path, params.file, {
    upsert: false,
    contentType: params.file.type || `image/${ext}`,
  })
  if (uploadError) throw uploadError

  if (params.previousPath) {
    await supabase.storage.from(RECEIPTS_BUCKET).remove([params.previousPath])
  }

  return {
    receipt_path: path,
    receipt_filename: params.file.name,
    receipt_mime_type: params.file.type || `image/${ext}`,
    receipt_size_bytes: params.file.size,
  }
}

export async function deleteReceiptAttachment(path?: string | null) {
  if (!supabase || !path) return
  await supabase.storage.from(RECEIPTS_BUCKET).remove([path])
}

