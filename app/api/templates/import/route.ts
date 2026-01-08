/**
 * POST /api/templates/import - Import template from uploaded zip file
 */

import { NextRequest, NextResponse } from 'next/server';
import { importTemplate } from '@/lib/services/template';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    // Parse multipart form data
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json(
        {
          success: false,
          error: '未选择文件',
        },
        { status: 400 }
      );
    }

    // Check file extension
    if (!file.name.endsWith('.zip')) {
      return NextResponse.json(
        {
          success: false,
          error: '只支持 .zip 格式文件',
        },
        { status: 400 }
      );
    }

    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Import template
    const result = await importTemplate(buffer);

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          error: result.message,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        templateId: result.templateId,
        message: result.message,
      },
    });
  } catch (error) {
    console.error('[API] Failed to import template:', error);

    const errorMessage = error instanceof Error ? error.message : '导入失败';

    return NextResponse.json(
      {
        success: false,
        error: errorMessage,
      },
      { status: 500 }
    );
  }
}
