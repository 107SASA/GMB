import axios from "axios";

const API = axios.create({
  baseURL: "/api",
});

API.interceptors.request.use((req) => {
  if (typeof window !== "undefined") {
    // any client side auth token injection
  }
  return req;
});

export default API;
