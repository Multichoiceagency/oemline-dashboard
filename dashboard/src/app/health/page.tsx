"use client";

import { useApi, useInterval } from "@/lib/hooks";
import { getHealth } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Activity,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Database,
  Server,
  Wifi,
} from "lucide-react";

const SERVICE_ICONS: Record<string, React.ReactNode> = {
  postgres: <Database className="h-4 w-4" />,
  redis: <Server className="h-4 w-4" />,
  meilisearch: <Wifi className="h-4 w-4" />,
};

export default function HealthPage() {
  const { data, error, loading, refetch } = useApi(() => getHealth(), []);

  useInterval(() => refetch(), 10000);

  const uptime = data?.uptime ?? 0;
  const days = Math.floor(uptime / 86400);
  const hours = Math.floor((uptime % 86400) / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  const seconds = Math.floor(uptime % 60);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">System Health</h2>
        <p className="text-muted-foreground">Real-time monitoring of all platform services (auto-refreshes every 10s)</p>
      </div>

      {loading && !data ? (
        <p className="text-muted-foreground">Loading health status...</p>
      ) : error ? (
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-destructive">
              <XCircle className="h-5 w-5" />
              <span className="font-medium">API Unreachable:</span> {error}
            </div>
          </CardContent>
        </Card>
      ) : data ? (
        <>
          {/* Overall status */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Status</CardTitle>
                <Activity className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  {data.status === "healthy" ? (
                    <CheckCircle2 className="h-6 w-6 text-green-500" />
                  ) : (
                    <AlertTriangle className="h-6 w-6 text-yellow-500" />
                  )}
                  <span className="text-2xl font-bold capitalize">{data.status}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Uptime</CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {days > 0 && `${days}d `}{hours}h {minutes}m {seconds}s
                </div>
                <p className="text-xs text-muted-foreground">
                  Since {new Date(Date.now() - uptime * 1000).toLocaleString("nl-NL")}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Services</CardTitle>
                <Server className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {Object.values(data.checks).filter((s) => s === "ok").length}/
                  {Object.keys(data.checks).length}
                </div>
                <p className="text-xs text-muted-foreground">Services operational</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Queue Depth</CardTitle>
                <Activity className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {Object.values(data.queues).reduce((sum, q) => sum + (typeof q === "number" ? q : (q.waiting + q.active)), 0)}
                </div>
                <p className="text-xs text-muted-foreground">Total active + pending jobs</p>
              </CardContent>
            </Card>
          </div>

          {/* Service details */}
          <Card>
            <CardHeader>
              <CardTitle>Service Status</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Service</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.entries(data.checks).map(([name, status]) => (
                    <TableRow key={name}>
                      <TableCell className="font-medium flex items-center gap-2">
                        {SERVICE_ICONS[name] ?? <Server className="h-4 w-4" />}
                        <span className="capitalize">{name}</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={status === "ok" ? "success" : "destructive"}>
                          {status === "ok" ? (
                            <CheckCircle2 className="mr-1 h-3 w-3" />
                          ) : (
                            <XCircle className="mr-1 h-3 w-3" />
                          )}
                          {status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {name === "postgres" && "PostgreSQL database"}
                        {name === "redis" && "Redis cache & queue broker"}
                        {name === "meilisearch" && "Meilisearch full-text search engine"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Queue status */}
          <Card>
            <CardHeader>
              <CardTitle>Background Queues</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Queue</TableHead>
                    <TableHead>Active</TableHead>
                    <TableHead>Waiting</TableHead>
                    <TableHead>Completed</TableHead>
                    <TableHead>Failed</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.entries(data.queues).map(([queue, info]) => {
                    const q = typeof info === "number"
                      ? { waiting: info, active: 0, completed: 0, failed: 0 }
                      : info;
                    const isActive = q.active > 0;
                    const hasPending = q.waiting > 0;
                    return (
                      <TableRow key={queue}>
                        <TableCell className="font-medium capitalize">{queue}</TableCell>
                        <TableCell className="font-mono">{q.active}</TableCell>
                        <TableCell className="font-mono">{q.waiting}</TableCell>
                        <TableCell className="font-mono text-muted-foreground">{q.completed}</TableCell>
                        <TableCell className="font-mono">
                          {q.failed > 0 ? (
                            <span className="text-destructive">{q.failed}</span>
                          ) : (
                            q.failed
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={isActive ? "secondary" : hasPending ? "warning" : q.failed > 0 ? "destructive" : "success"}>
                            {isActive ? "Processing" : hasPending ? "Queued" : "Idle"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Circuit breakers */}
          {Object.keys(data.circuits).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Circuit Breakers</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Supplier</TableHead>
                      <TableHead>State</TableHead>
                      <TableHead>Failures</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(data.circuits).map(([name, info]) => (
                      <TableRow key={name}>
                        <TableCell className="font-medium">{name}</TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              info.state === "closed"
                                ? "success"
                                : info.state === "open"
                                ? "destructive"
                                : "warning"
                            }
                          >
                            {info.state}
                          </Badge>
                        </TableCell>
                        <TableCell>{info.failures}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          <p className="text-xs text-muted-foreground text-center">
            Last updated: {new Date(data.timestamp).toLocaleString("nl-NL")}
          </p>
        </>
      ) : null}
    </div>
  );
}
