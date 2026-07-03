/**
 * credentials.ts — User accounts for Chassis Workbench login.
 *
 * Values are SHA-256 hashes of the passwords.
 * To generate a hash in Node:
 *   node -e "require('crypto').createHash('sha256').update('mypassword').digest('hex')"
 *
 * Default account:  admin / chassis2025
 */
export const CREDENTIALS: Record<string, string> = {
  admin:    '16416b66cf254e1cfdf3030d6206b6b63d401382c1365490da6777d39ee4f64b', // chassis2025
  dikshant: '9c5e0fd3a55a97d66d4b86bc023d7a645b779572c4a9c2a1e52c7bcdf5d3a5f9', // change me
};
