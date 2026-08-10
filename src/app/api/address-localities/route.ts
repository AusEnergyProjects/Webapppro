import { addressLocalitiesGet } from "@/lib/address-localities-route.mjs";

export const runtime = "edge";

export const GET = addressLocalitiesGet;
