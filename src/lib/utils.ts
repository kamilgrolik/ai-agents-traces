import * as crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Hash an IP address for rate-limiting storage without storing PII.
 * Uses SHA-256 with a salt derived from the environment.
 */
export function hashIP(ip: string): string {
  const salt = import.meta.env.SUPABASE_SERVICE_ROLE_KEY?.slice(0, 16) ?? 'ai-agents-traces-salt';
  return crypto
    .createHash('sha256')
    .update(salt + ip)
    .digest('hex')
    .slice(0, 32);
}

/**
 * Log traffic metrics to Supabase for M2M analytics.
 */
export async function logTraffic(supabase: SupabaseClient, request: Request): Promise<void> {
  try {
    const ip = getClientIP(request);
    const userAgent = request.headers.get('user-agent') || 'unknown';
    const method = request.method;
    const path = new URL(request.url).pathname;

    // Fire and forget (don't await so we don't block the response)
    supabase.from('traffic_logs').insert({
      ip_hash: hashIP(ip),
      user_agent: userAgent,
      path: path,
      method: method
    }).then();
  } catch (e) {
    console.error('Logging failed:', e);
  }
}

/**
 * Returns a human-readable label for an auto-flag.
 */
export function flagLabel(flag: string): string {
  switch (flag) {
    case 'POTENTIAL_SPAM':    return '[ POTENTIAL SPAM ]';
    case 'POTENTIAL_INJECTION': return '[ PROMPT INJECTION ]';
    case 'HIGH_ENTROPY':      return '[ HIGH ENTROPY ]';
    default:                  return `[ ${flag} ]`;
  }
}

/**
 * Analyse a payload string and return a list of auto-flags.
 */
export function analyzePayload(payload: string): string[] {
  const flags: string[] = [];

  // Count URLs
  const urlCount = (payload.match(/https?:\/\//gi) || []).length;
  if (urlCount > 3) flags.push('POTENTIAL_SPAM');

  // Detect prompt injection / jailbreak patterns
  const injectionPatterns = [
    /ignore\s+(all\s+)?previous\s+instructions?/i,
    /forget\s+(all\s+)?previous/i,
    /you\s+are\s+now\s+(a\s+)?(?:DAN|jailbreak|evil|unrestricted)/i,
    /\bSELECT\b.*\bFROM\b/i,
    /\bDROP\s+TABLE\b/i,
    /\bINSERT\s+INTO\b/i,
    /<script[\s>]/i,
    /\beval\s*\(/i,
  ];
  if (injectionPatterns.some((p) => p.test(payload))) {
    flags.push('POTENTIAL_INJECTION');
  }

  // Detect high-entropy payloads (>40% special chars)
  const specialChars = (payload.match(/[^a-zA-Z0-9\s]/g) || []).length;
  if (specialChars / payload.length > 0.4) {
    flags.push('HIGH_ENTROPY');
  }

  // Repeated characters (spam pattern)
  if (/(.)\1{9,}/.test(payload)) {
    flags.push('POTENTIAL_SPAM');
  }

  return [...new Set(flags)]; // deduplicate
}

/**
 * Extract real client IP, honouring proxy headers.
 */
export function getClientIP(request: Request): string {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-real-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}
