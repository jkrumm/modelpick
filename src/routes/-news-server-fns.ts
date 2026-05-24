import { createServerFn } from "@tanstack/react-start";
import { getReasonableNews } from "~/db/queries";
import type { NewsItem } from "~/db/schema";

export const getNewsFeed = createServerFn({ method: "GET" }).handler(
  async (): Promise<NewsItem[]> => {
    return getReasonableNews(50);
  },
);
