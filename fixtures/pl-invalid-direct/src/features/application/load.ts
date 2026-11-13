import axios from "axios";

export const loadApplication = (id: string) => axios.get(`/applications/${id}`);
