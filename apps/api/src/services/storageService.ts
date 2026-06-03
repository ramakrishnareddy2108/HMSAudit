import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { NodeHttpHandler } from '@aws-sdk/node-http-handler'
import { Agent } from 'https'
import sharp from 'sharp'

const s3 = new S3Client({
  endpoint: process.env.R2_ENDPOINT,
  region: 'auto',
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
  requestHandler: new NodeHttpHandler({
    httpsAgent: new Agent({
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
    }),
  }),
})

const BUCKET = process.env.R2_BUCKET_NAME!
const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp']

interface UploadParams {
  buffer: Buffer
  filename: string
  mimetype: string
  folder: string
}

export const storageService = {
  async uploadFile({ buffer, filename, mimetype, folder }: UploadParams): Promise<{ path: string }> {
    const isImage = IMAGE_MIMES.includes(mimetype)
    const ext = isImage ? 'jpg' : (filename.split('.').pop()?.toLowerCase() ?? 'bin')
    const path = `${folder}/${crypto.randomUUID()}-${Date.now()}.${ext}`

    let uploadBuffer = buffer
    let uploadMimeType = mimetype

    if (isImage) {
      uploadBuffer = await sharp(buffer)
        .resize({ width: 1200, withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer()
      uploadMimeType = 'image/jpeg'
    }

    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: path,
        Body: uploadBuffer,
        ContentType: uploadMimeType,
      }),
    )

    return { path }
  },

  async getPresignedUrl(path: string, expiresIn = 900): Promise<string> {
    return getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: path }), { expiresIn })
  },

  async deleteFile(path: string): Promise<void> {
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: path }))
    } catch (err) {
      console.error('[storageService] deleteFile error:', err)
    }
  },

  async getStorageStats(): Promise<{ totalSizeBytes: number; fileCount: number }> {
    let totalSizeBytes = 0
    let fileCount = 0
    let continuationToken: string | undefined
    do {
      const response = await s3.send(
        new ListObjectsV2Command({ Bucket: BUCKET, ContinuationToken: continuationToken }),
      )
      for (const obj of response.Contents ?? []) {
        totalSizeBytes += obj.Size ?? 0
        fileCount++
      }
      continuationToken = response.NextContinuationToken
    } while (continuationToken)
    return { totalSizeBytes, fileCount }
  },
}
