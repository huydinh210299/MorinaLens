const input = require("./input");

const DEFAULT_LIMIT = 20;

function paginate(total, requestedPage, limit = DEFAULT_LIMIT) {
  const pages = Math.max(1, Math.ceil(total / limit));
  const page = Math.min(input.page(requestedPage), pages);
  return { total, page, limit, pages, skip: (page - 1) * limit };
}
function paginateRows(rows, requestedPage, limit = DEFAULT_LIMIT) {
  const pagination = paginate(rows.length, requestedPage, limit);
  return { ...pagination, items: rows.slice(pagination.skip, pagination.skip + pagination.limit) };
}
module.exports = { DEFAULT_LIMIT, paginate, paginateRows };
