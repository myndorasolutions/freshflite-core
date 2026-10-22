#pragma once

#include <stddef.h>
#include <stdint.h>

void radio_begin();
void radio_enter_silent();
void radio_wake();

/** Publish a binary burst. Returns true only when a broker accepts the packet. */
bool radio_publish_burst(const uint8_t* data, size_t length);
