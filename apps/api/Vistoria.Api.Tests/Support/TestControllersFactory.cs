using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;

namespace Vistoria.Api.Tests.Support;

/// <summary>
/// API com os controllers do projeto de testes (<c>ThrowingController</c>, <c>ContractController</c>,
/// <c>ProtectedController</c>...) como application part. Eles ficam fora do <c>openapi.json</c> commitado, que só
/// enxerga o projeto da API.
/// </summary>
public class TestControllersFactory : ApiFactory
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.ConfigureServices(services =>
            services.AddControllers().AddApplicationPart(typeof(TestControllersFactory).Assembly));
    }
}
