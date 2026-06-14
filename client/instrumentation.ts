import { WebTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-web';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ZoneContextManager } from '@opentelemetry/context-zone';

const exporter = new OTLPTraceExporter({
  url: `${process.env.REACT_APP_OTEL_ENDPOINT || 'https://ingest.kubiks.app'}/v1/traces`,
});

const provider = new WebTracerProvider({
  resource: new Resource({
    'service.name': 'seerfinale626-frontend',
  }),
});

provider.addSpanProcessor(new BatchSpanProcessor(exporter));
provider.register({
  contextManager: new ZoneContextManager(),
});
