import { Booking } from "./model.server";

// GET /api/bookings — what the agent has booked, newest first.
export const loader = () => Response.json(Booking.recent());
