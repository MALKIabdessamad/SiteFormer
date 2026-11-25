// Public configuration shared by the browser and the server. Nothing secret lives here:
// the Supabase publishable key is designed to be shipped to the browser.
export const SUPABASE_URL: string =
  import.meta.env?.VITE_SUPABASE_URL ?? 'https://wuqraxscnshbivgjjyee.supabase.co'

export const SUPABASE_PUBLISHABLE_KEY: string =
  import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY ??
  'sb_publishable_94JZqrmRmSFdn8oCyLb4mw_UWRZJn5Z'
