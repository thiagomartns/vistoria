using Vistoria.Api.Configurations;

var builder = WebApplication.CreateBuilder(args);

builder.AddSerilogLogging();
builder.Services.AddClock();
builder.Services.AddErrorHandling();
builder.Services.AddOpenApiDocs();
builder.Services.AddApiControllers();
builder.Services.AddDatabase(builder.Configuration);
builder.Services.AddDevCors(builder.Environment);
builder.Services.AddRateLimits();
builder.Services.AddAuth(builder.Configuration);

var app = builder.Build();

// Ordem de backend.md, "Ambientes e hospedagem": erros → CORS → rate limit → autenticação → autorização.
app.UseErrorHandling();
app.UseSerilogLogging();
app.UseOpenApiDocs();
app.UseDevCors();
app.UseRateLimits();
app.UseAuth();
app.MapControllers();

await app.MigrateDatabaseAsync();
await app.RunAsync();
