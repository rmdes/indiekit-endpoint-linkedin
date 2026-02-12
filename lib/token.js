import process from "node:process";

/**
 * Save LinkedIn OAuth token to MongoDB and process.env
 * @param {object} collection - MongoDB collection (or null)
 * @param {object} tokenData - Token data from OAuth exchange
 * @param {string} tokenData.access_token - LinkedIn access token
 * @param {string} [tokenData.id_token] - LinkedIn ID token
 * @param {number} [tokenData.expires_in] - Token lifetime in seconds
 * @returns {Promise<void>}
 */
export async function saveToken(collection, tokenData) {
  const { access_token, id_token, expires_in } = tokenData;

  // Always update process.env for immediate syndicator use
  process.env.LINKEDIN_ACCESS_TOKEN = access_token;

  if (!collection) return;

  const doc = {
    _id: "current",
    access_token,
    updated_at: new Date().toISOString(),
  };

  if (id_token) {
    doc.id_token = id_token;
  }

  if (expires_in) {
    doc.expires_at = new Date(Date.now() + expires_in * 1000).toISOString();
  }

  await collection.replaceOne({ _id: "current" }, doc, { upsert: true });
}

/**
 * Restore LinkedIn OAuth token from MongoDB to process.env
 * @param {object} collection - MongoDB collection (or null)
 * @returns {Promise<object|null>} Token document or null
 */
export async function restoreToken(collection) {
  if (!collection) return null;

  const doc = await collection.findOne({ _id: "current" });
  if (!doc?.access_token) return null;

  process.env.LINKEDIN_ACCESS_TOKEN = doc.access_token;
  return doc;
}
