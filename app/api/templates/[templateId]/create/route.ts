/**
 * POST /api/templates/[templateId]/create - Create new project from template
 */

import { NextRequest, NextResponse } from 'next/server';
import { createProjectFromTemplate } from '@/lib/services/template';
import { checkTemplateHasMock, executeDemoModeForTemplate } from '@/lib/services/demo-mode';
import { randomUUID } from 'crypto';

export const dynamic = 'force-dynamic';

interface CreateProjectRequest {
  name?: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ templateId: string }> }
) {
  try {
    const { templateId } = await params;
    const body: CreateProjectRequest = await request.json().catch(() => ({}));

    // Create project from template
    const result = await createProjectFromTemplate(templateId, body.name);

    // Check if template has mock.json and trigger demo replay
    const hasMock = await checkTemplateHasMock(templateId);
    if (hasMock) {
      const requestId = randomUUID();
      console.log(`[API] Template ${templateId} has mock.json, triggering demo replay for ${result.projectId}`);
      // Run demo replay asynchronously (don't block the response)
      executeDemoModeForTemplate(templateId, result.projectId, requestId).catch(err => {
        console.error(`[API] Demo replay failed for ${result.projectId}:`, err);
      });
    }

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('[API] Failed to create project from template:', error);

    const errorMessage = error instanceof Error ? error.message : 'Failed to create project';

    return NextResponse.json(
      {
        success: false,
        error: errorMessage,
      },
      { status: 500 }
    );
  }
}
