function countItems(inventory, names) {
  const wanted = Array.isArray(names) ? names : [names];
  return wanted.reduce((total, name) => total + (inventory[name] || 0), 0);
}

function hasAny(inventory, names) {
  return countItems(inventory, names) > 0;
}

function inventoryFromBot(bot) {
  return bot.inventory.items().reduce((items, item) => {
    items[item.name] = (items[item.name] || 0) + item.count;
    return items;
  }, {});
}

function firstInventoryItem(bot, names) {
  const wanted = new Set(Array.isArray(names) ? names : [names]);
  return bot.inventory.items().find((item) => wanted.has(item.name));
}

module.exports = {
  countItems,
  firstInventoryItem,
  hasAny,
  inventoryFromBot
};