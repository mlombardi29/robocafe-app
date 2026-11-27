-- Pin search_path on private.distinct_sites (Supabase advisor 0011 function_search_path_mutable).
-- Body only uses pg_catalog built-ins, so an empty search_path keeps behavior identical.
ALTER FUNCTION private.distinct_sites(uuid[]) SET search_path = '';
