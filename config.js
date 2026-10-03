// Public connection details for the FleetMonitor Supabase project.
// The publishable key is designed to be public: row-level security in the database is what protects the data.
// Never put a secret or service_role key in this file.
export const CONFIG = {
  supabaseUrl: 'https://qfszeiakbjunaeosglmf.supabase.co',
  supabaseKey: 'sb_publishable_xYGF7V4DVKmQJqL_MpHG2Q_ZgvY5YT4',
  appName: 'FleetMonitor',
  // Branding for the sign-in screen, which appears before we know who is signing in.
  // After sign-in the organisation's own brand (organisations.brand in the database) takes over.
  // To host the logo yourself, save it in this folder as logo.png and set logoUrl: 'logo.png'.
  brand: {
    name: 'Alchemy Drinks',
    logoUrl: 'https://alchemydrinks.co.uk/wp-content/uploads/2024/08/Screenshot-2024-08-02-at-15.51.13.png',
  },
};
