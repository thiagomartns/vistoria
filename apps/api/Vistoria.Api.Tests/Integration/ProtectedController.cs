using Microsoft.AspNetCore.Mvc;

namespace Vistoria.Api.Tests.Integration;

/// <summary>
/// Rota sem <c>[AllowAnonymous]</c>, protegida só pela fallback policy, como as rotas do M2. Devolve o <c>sub</c>
/// do token. Fica só no projeto de testes (via <c>TestControllersFactory</c>).
/// </summary>
[ApiController]
[Route("test/protected")]
public class ProtectedController : ControllerBase
{
    [HttpGet]
    public IActionResult Get() => Ok(new { sub = User.FindFirst("sub")?.Value });
}
