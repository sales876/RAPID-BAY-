import { getSupabaseClient } from '../supabase/client';
import { LocalRepository } from './local';
import { SupabaseRepository } from './supabase';
import type { Repository } from './types';

let repository: Repository | null = null;

/**
 * Resolves the data layer once per browser session: Supabase when the project
 * is configured, otherwise the local demo store.
 */
export function getRepository(): Repository {
  if (repository) return repository;
  const supabase = getSupabaseClient();
  repository = supabase ? new SupabaseRepository(supabase) : new LocalRepository();
  return repository;
}

export type { Repository };
