using System.Globalization;
using Serilog;

namespace Vistoria.Api.Configurations;

public static class LoggingConfig
{
    public static WebApplicationBuilder AddSerilogLogging(this WebApplicationBuilder builder)
    {
        builder.Services.AddSerilog((services, logger) => logger
            .ReadFrom.Configuration(builder.Configuration)
            .ReadFrom.Services(services)
            .Enrich.FromLogContext()
            .WriteTo.Console(formatProvider: CultureInfo.InvariantCulture));

        return builder;
    }

    public static WebApplication UseSerilogLogging(this WebApplication app)
    {
        app.UseSerilogRequestLogging();
        return app;
    }
}
