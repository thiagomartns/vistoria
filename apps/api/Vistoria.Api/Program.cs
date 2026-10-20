using Vistoria.Api.Configurations;

var builder = WebApplication.CreateBuilder(args);

builder.AddSerilogLogging();
builder.Services.AddClock();
builder.Services.AddErrorHandling();
builder.Services.AddOpenApiDocs();
builder.Services.AddApiControllers();
builder.Services.AddDatabase(builder.Configuration);
builder.Services.AddAuth(builder.Configuration);

var app = builder.Build();

app.UseErrorHandling();
app.UseSerilogLogging();
app.UseOpenApiDocs();
app.MapControllers();

await app.MigrateDatabaseAsync();
await app.RunAsync();
