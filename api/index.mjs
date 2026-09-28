import { handleCloudRequest } from "../cloud/handler.mjs";

export default async function handler(req, res) {
  return handleCloudRequest(req, res);
}
