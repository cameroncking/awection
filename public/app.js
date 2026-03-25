const header = document.querySelector("[data-auction-status]");
const label = document.querySelector("[data-auction-label]");
const auctionEndsAt = document.body.dataset.auctionEndsAt;

function tickAuctionHeader() {
  if (!header || !label || !auctionEndsAt) {
    return;
  }

  const remainingMs = new Date(auctionEndsAt).getTime() - Date.now();
  if (remainingMs <= 0) {
    header.dataset.state = "closed";
    label.textContent = "CLOSED";
    return;
  }

  const remainingMinutes = remainingMs / 60000;
  if (remainingMinutes > 10) {
    header.dataset.state = "green";
  } else if (remainingMinutes >= 5) {
    header.dataset.state = "yellow";
  } else {
    header.dataset.state = "red";
  }

  const totalSeconds = Math.floor(remainingMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if (days > 0) {
    parts.push(`${days} day${days === 1 ? "" : "s"}`);
  }
  if (hours > 0 || days > 0) {
    parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
  }
  parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
  parts.push(`${seconds} second${seconds === 1 ? "" : "s"}`);
  label.textContent = `${parts.join(" ")} remaining`;
}

tickAuctionHeader();
setInterval(tickAuctionHeader, 1000);

const loadMore = document.querySelector("[data-load-more]");
const grid = document.getElementById("popular-grid");

async function fetchMore() {
  if (!loadMore || !grid || loadMore.dataset.loading === "true") {
    return;
  }

  loadMore.dataset.loading = "true";
  const endpoint = loadMore.dataset.endpoint;
  if (!endpoint) {
    return;
  }

  const response = await fetch(endpoint);
  const payload = await response.json();
  if (payload.html) {
    grid.insertAdjacentHTML("beforeend", payload.html);
  }
  if (payload.done) {
    loadMore.remove();
    return;
  }
  loadMore.dataset.endpoint = endpoint.replace(/offset=\d+/, `offset=${payload.nextOffset}`);
  loadMore.dataset.loading = "false";
}

if (loadMore) {
  loadMore.querySelector("button")?.addEventListener("click", fetchMore);
  const observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) {
      fetchMore();
    }
  }, { rootMargin: "300px" });
  observer.observe(loadMore);
}
