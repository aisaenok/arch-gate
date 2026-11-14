import axios from "axios";

const get = axios.get;

export async function getApplication(id: string) {
  return get(`/api/applications/${id}`);
}
