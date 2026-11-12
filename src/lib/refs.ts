import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';

/** Reference lists many screens need: areas, posts, document and leave types. Cached for a minute. */
export function useAreas() {
  return useQuery({
    queryKey: ['areas'],
    queryFn: async () => {
      const { data, error } = await supabase.from('areas').select('id,name,region,office_address,is_active').order('name');
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
  });
}

export function useSites() {
  return useQuery({
    queryKey: ['sites-list'],
    queryFn: async () => {
      const { data, error } = await supabase.from('sites').select('id,name,code,city,area_id,client_id,pay_rule_id,duty_hours,first_shift_start,is_active').order('name');
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
  });
}

export function useDocTypes() {
  return useQuery({
    queryKey: ['document-types'],
    queryFn: async () => {
      const { data, error } = await supabase.from('document_types').select('*').order('sort_order');
      if (error) throw error;
      return data as {
        id: string; code: string; name: string; category: string; has_expiry: boolean; required_for_deployment: boolean;
        remind_days_before: number; visible_to_employee: boolean; employee_can_upload: boolean; sort_order: number; is_active: boolean;
        storage_folder: '201-file' | 'work-requirements' | 'lesp';
      }[];
    },
    staleTime: 60_000,
  });
}

export function useLeaveTypes() {
  return useQuery({
    queryKey: ['leave-types'],
    queryFn: async () => {
      const { data, error } = await supabase.from('leave_types').select('*').order('sort_order');
      if (error) throw error;
      return data as {
        id: string; code: string; name: string; description: string | null; days_per_year: number | null; max_days_per_request: number | null;
        is_paid: boolean; requires_attachment: boolean; applies_to_sex: string | null; min_service_months: number; is_active: boolean; sort_order: number;
      }[];
    },
    staleTime: 60_000,
  });
}

/** PostgREST "or" filters break on commas and brackets: keep search text to safe characters. */
export const safeSearch = (v: string) => v.replace(/[^\p{L}\p{N}\s.'-]/gu, ' ').trim();
