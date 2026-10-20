using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;

namespace Vistoria.Api.Tests.Support;

/// <summary>
/// API com os controllers do projeto de testes (<c>ThrowingController</c>, <c>ContractController</c>) como
/// application part. Eles ficam fora do <c>openapi.json</c> commitado, que só enxerga o projeto da API.
/// </summary>
public class TestControllersFactory : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(IWebHostBuilder builder) =>
        builder.ConfigureServices(services =>
            services.AddControllers().AddApplicationPart(typeof(TestControllersFactory).Assembly));
}
