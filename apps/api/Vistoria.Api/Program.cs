using Vistoria.Api.Configurations;

var builder = WebApplication.CreateBuilder(args);

builder.AddSerilogLogging();
builder.Services.AddClock();
builder.Services.AddErrorHandling();
builder.Services.AddOpenApiDocs();
builder.Services.AddApiControllers();
builder.Services.AddDatabase(builder.Configuration);
builder.Services.AddHealth();
builder.Services.AddMappings();
builder.Services.AddDomainServices();
builder.Services.AddIdempotency();
builder.Services.AddDevCors(builder.Environment);
builder.Services.AddProxyHeaders();
builder.Services.AddRateLimits();
builder.Services.AddAuth(builder.Configuration);

var app = builder.Build();

// Ordem de backend.md, "Ambientes e hospedagem": IP do proxy → erros → CORS → rate limit → autenticação → autorização.
app.UseProxyHeaders();
app.UseErrorHandling();
app.UseSerilogLogging();
app.UseOpenApiDocs();
app.UseDevCors();
app.UseRateLimits();
app.UseAuth();
app.MapControllers();
app.MapHealth();

await app.MigrateDatabaseAsync();
await app.RunAsync();
