using AwesomeAssertions;
using Vistoria.Api.Infrastructure.Validation;

namespace Vistoria.Api.Tests.Unit;

public class TelefoneAttributeTests
{
    private static readonly TelefoneAttribute Attribute = new();

    [Theory]
    [InlineData("7133330000")]  // fixo
    [InlineData("1125550000")]  // fixo começando por 2
    [InlineData("71999990000")] // celular
    [InlineData("11912345678")] // celular
    public void Canonical_Passes(string phone)
    {
        Attribute.IsValid(phone).Should().BeTrue();
        TelefoneAttribute.Normalize(phone).Should().Be(phone);
    }

    [Theory]
    [InlineData("(71) 3333-0000", "7133330000")]
    [InlineData("(71) 99999-0000", "71999990000")]
    [InlineData("71 9 9999 0000", "71999990000")]
    [InlineData("+55 71 99999-0000", "71999990000")]
    [InlineData("+55 (71) 3333-0000", "7133330000")]
    [InlineData("5571999990000", "71999990000")]
    [InlineData("71.3333.0000", "7133330000")]
    [InlineData("(11) 91234/5678", "11912345678")]
    public void Masked_IsNormalizedAndPasses(string input, string canonical)
    {
        TelefoneAttribute.Normalize(input).Should().Be(canonical);
        Attribute.IsValid(input).Should().BeTrue();
    }

    [Fact]
    public void Null_Passes_BecauseTheFieldIsOptional()
    {
        Attribute.IsValid(null).Should().BeTrue();
        TelefoneAttribute.Normalize(null).Should().BeNull();
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("3333-0000")]          // sem DDD
    [InlineData("(10) 3333-0000")]     // DDD que não existe
    [InlineData("(20) 99999-0000")]    // DDD que não existe
    [InlineData("(71) 9999-0000")]     // 10 dígitos começando por 9: o celular antigo, sem o 9 na frente
    [InlineData("(71) 6333-0000")]     // fixo começando por 6
    [InlineData("(71) 83333-0000")]    // 11 dígitos sem o 9
    [InlineData("(71) 999999-0000")]   // 12 dígitos
    [InlineData("+1 415 555 0100")]    // de fora do Brasil
    [InlineData("+351 912 345 678")]   // de fora do Brasil
    [InlineData("ramal 12")]
    [InlineData("７１３３３３００００")] // dígitos que não são ASCII
    public void Invalid_Fails(string phone)
    {
        Attribute.IsValid(phone).Should().BeFalse();
    }

    [Fact]
    public void NonString_Fails()
    {
        Attribute.IsValid(7133330000L).Should().BeFalse();
    }

    [Fact]
    public void Ddds_AreThe67OfAnatel()
    {
        TelefoneAttribute.Ddds.Should().HaveCount(67);
    }
}
