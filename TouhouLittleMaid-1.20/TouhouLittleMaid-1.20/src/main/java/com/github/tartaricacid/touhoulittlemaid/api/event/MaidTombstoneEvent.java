package com.github.tartaricacid.touhoulittlemaid.api.event;

import com.github.tartaricacid.touhoulittlemaid.entity.item.EntityTombstone;
import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import net.minecraftforge.eventbus.api.Cancelable;
import net.minecraftforge.eventbus.api.Event;

@Cancelable
public class MaidTombstoneEvent extends Event {
    private final EntityMaid maid;
    private final EntityTombstone tombstone;

    public MaidTombstoneEvent(EntityMaid maid, EntityTombstone tombstone) {
        this.maid = maid;
        this.tombstone = tombstone;
    }

    public EntityMaid getMaid() {
        return maid;
    }

    public EntityTombstone getTombstone() {
        return tombstone;
    }
}
