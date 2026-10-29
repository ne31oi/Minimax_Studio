import { NextRequest, NextResponse } from 'next/server'
import {
  listRefModJobs,
  refreshRefModJob,
  submitRefModJob,
  cancelRefModJob,
} from '@/lib/refmods/jobs'
import { refModError } from '@/lib/refmods/http'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id')
    if (id) return NextResponse.json({ job: await refreshRefModJob(id) })
    const jobs = await Promise.all(
      listRefModJobs().map(async (j) => {
        try {
          return await refreshRefModJob(j.id)
        } catch {
          return j
        }
      }),
    )
    return NextResponse.json({ jobs })
  } catch (e) {
    return refModError(e)
  }
}
export async function POST(req: NextRequest) {
  try {
    return NextResponse.json({ job: await submitRefModJob(await req.json()) })
  } catch (e) {
    return refModError(e)
  }
}
export async function DELETE(req: NextRequest) {
  try {
    return NextResponse.json({ job: await cancelRefModJob((await req.json()).id) })
  } catch (e) {
    return refModError(e)
  }
}
