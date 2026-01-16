/**
 * Skills API - Single Skill Operations
 * GET /api/skills/:name - Get skill detail
 * DELETE /api/skills/:name - Delete skill
 * PUT /api/skills/:name - Update enabled state
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSkillDetail, deleteSkill, setSkillEnabled } from '@/lib/services/skill-service';

interface RouteParams {
  params: Promise<{ name: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { name } = await params;
    const decodedName = decodeURIComponent(name);
    const detail = await getSkillDetail(decodedName);

    if (!detail) {
      return NextResponse.json(
        { success: false, error: 'Skill not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: detail });
  } catch (error) {
    console.error('[Skills API] Error getting skill detail:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { name } = await params;
    const decodedName = decodeURIComponent(name);
    await deleteSkill(decodedName);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Skills API] Error deleting skill:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = message.includes('Cannot delete builtin') ? 403 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { name } = await params;
    const decodedName = decodeURIComponent(name);
    const body = await request.json();
    const { enabled } = body;

    if (typeof enabled !== 'boolean') {
      return NextResponse.json(
        { success: false, error: 'enabled (boolean) is required' },
        { status: 400 }
      );
    }

    await setSkillEnabled(decodedName, enabled);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Skills API] Error updating skill:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
