export type ContactKind = "email" | "phone";

export type Viewer = {
  id: number;
  nickname: string;
  email: string | null;
  phone: string | null;
  isAdmin: boolean;
};

export type ItemRow = {
  id: number;
  slug: string;
  title: string;
  description: string;
  category_id: number;
  category_name: string;
  image_url: string | null;
  donor_name: string | null;
  retail_value_cents: number | null;
  starting_bid_cents: number;
  min_increment_cents: number;
  buy_now_cents: number | null;
  popularity_score: number;
  bid_count: number;
  last_bid_at: string | null;
  created_at: string;
  current_bid_cents: number | null;
  current_bidder_nickname: string | null;
};

export type DashboardData = {
  recent: ItemRow[];
  fresh: ItemRow[];
  popular: ItemRow[];
};

export type Flash = {
  kind: "success" | "error" | "info";
  message: string;
};

export type LoginStep = "start" | "register" | "verify";

export type AccountBidRow = {
  item_id: number;
  item_slug: string;
  item_title: string;
  category_name: string;
  my_bid_cents: number;
  leading_bid_cents: number;
  is_leading: number;
  did_win: number;
};
