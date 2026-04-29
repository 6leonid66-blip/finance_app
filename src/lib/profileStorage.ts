import { supabase } from '../supabase'

const PROFILE_IMAGES_BUCKET = 'profile-images'

function normalizeExt(file: File): string {
  const fromName = file.name.split('.').pop()?.toLowerCase()
  if (fromName && /^[a-z0-9]+$/.test(fromName)) return fromName
  if (file.type === 'image/png') return 'png'
  if (file.type === 'image/webp') return 'webp'
  return 'jpg'
}

export async function uploadProfileImage(params: {
  file: File
  userId: string
  previousPath?: string | null
}) {
  if (!supabase) throw new Error('Supabase לא מוגדר')
  const ext = normalizeExt(params.file)
  const cleanName = params.file.name.replace(/[^\p{L}\p{N}._-]/gu, '_')
  const path = `${params.userId}/${crypto.randomUUID()}-${cleanName || `avatar.${ext}`}`
  const { error: uploadError } = await supabase.storage.from(PROFILE_IMAGES_BUCKET).upload(path, params.file, {
    upsert: false,
    contentType: params.file.type || `image/${ext}`,
  })
  if (uploadError) throw uploadError
  if (params.previousPath) {
    await supabase.storage.from(PROFILE_IMAGES_BUCKET).remove([params.previousPath])
  }
  const { data } = supabase.storage.from(PROFILE_IMAGES_BUCKET).getPublicUrl(path)
  return {
    avatar_path: path,
    avatar_url: data.publicUrl || null,
  }
}

export async function deleteProfileImage(path?: string | null) {
  if (!supabase || !path) return
  await supabase.storage.from(PROFILE_IMAGES_BUCKET).remove([path])
}
