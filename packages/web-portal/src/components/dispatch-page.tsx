import { DispatchConsole } from "@/components/dispatch-console";
import { listDispatchFlights } from "@/lib/fleet-data";

export function DispatchPage({ initialFlightNumber }: { initialFlightNumber: string }) {
  const flights = listDispatchFlights();
  return <DispatchConsole flights={flights} initialFlightNumber={initialFlightNumber} />;
}
