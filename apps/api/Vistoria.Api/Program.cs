using Microsoft.AspNetCore.Mvc;
using Vistoria.Api.Configurations;

var builder = WebApplication.CreateBuilder(args);

builder.AddSerilogLogging();
builder.Services.AddErrorHandling();
builder.Services.AddOpenApiDocs();
builder.Services.AddControllers(options => options.Filters.Add(new ProducesAttribute("application/json")));

var app = builder.Build();

app.UseErrorHandling();
app.UseSerilogLogging();
app.UseOpenApiDocs();
app.MapControllers();

app.Run();
