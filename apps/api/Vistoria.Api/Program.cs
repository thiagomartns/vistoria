using Vistoria.Api.Configurations;

var builder = WebApplication.CreateBuilder(args);

builder.AddSerilogLogging();
builder.Services.AddErrorHandling();
builder.Services.AddOpenApiDocs();
builder.Services.AddApiControllers();

var app = builder.Build();

app.UseErrorHandling();
app.UseSerilogLogging();
app.UseOpenApiDocs();
app.MapControllers();

app.Run();
