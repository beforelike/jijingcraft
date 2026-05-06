function countItems(inventory, names) {
  const wanted = Array.isArray(names) ? names : [names];
  return wanted.reduce((total, name) => total + (inventory[name] || 0), 0);
}

function hasAny(inventory, names) {
  return countItems(inventory, names) > 0;
}

function inventoryFromBot(bot) {
  const inventoryItems = bot.inventory.items();
  const items = inventoryItems.reduce((counts, item) => {
    counts[item.name] = (counts[item.name] || 0) + item.count;
    return counts;
  }, {});

  const heldItem = bot.heldItem;
  const heldAlreadyCounted = heldItem && inventoryItems.some((item) => {
    if (item === heldItem) return true;
    return item.slot !== undefined && heldItem.slot !== undefined && item.slot === heldItem.slot;
  });
  if (heldItem && !heldAlreadyCounted) {
    items[heldItem.name] = (items[heldItem.name] || 0) + heldItem.count;
  }

  return items;
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